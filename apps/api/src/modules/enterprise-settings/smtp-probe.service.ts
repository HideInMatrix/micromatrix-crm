import { BadRequestException, Injectable } from '@nestjs/common'
import { connect as connectNet, type Socket } from 'node:net'
import { connect as connectTls, type TLSSocket } from 'node:tls'

type SmtpSocket = Socket | TLSSocket

interface SmtpProbeConfig {
  host: string
  port: number
  account: string
  password: string
  ssl: boolean
  tls: boolean
}

interface SmtpResponse {
  code: number
  lines: string[]
}

const CONNECT_TIMEOUT_MS = 8_000

@Injectable()
export class SmtpProbeService {
  async test(config: SmtpProbeConfig): Promise<void> {
    if (config.ssl && config.tls) {
      throw new BadRequestException('SSL 与 STARTTLS 不能同时启用')
    }

    let socket = await this.connect(config)
    try {
      await this.expect(socket, [220], 'SMTP 服务未返回欢迎信息')
      let ehlo = await this.command(socket, `EHLO micromatrix.local`, [250], 'EHLO 失败')

      if (config.tls) {
        if (!ehlo.lines.some((line) => line.toUpperCase().includes('STARTTLS'))) {
          throw new BadRequestException('SMTP 服务未声明 STARTTLS 能力')
        }
        await this.command(socket, 'STARTTLS', [220], 'STARTTLS 升级失败')
        socket = await this.upgradeTls(socket, config.host)
        ehlo = await this.command(socket, 'EHLO micromatrix.local', [250], 'TLS 后 EHLO 失败')
      }

      if (config.account && config.password) {
        await this.authenticate(socket, ehlo, config.account, config.password)
      }

      await this.command(socket, 'QUIT', [221], 'QUIT 失败').catch(() => undefined)
    } finally {
      if (!socket.destroyed) socket.destroy()
    }
  }

  private connect(config: SmtpProbeConfig): Promise<SmtpSocket> {
    return new Promise((resolve, reject) => {
      const socket = config.ssl
        ? connectTls({ host: config.host, port: config.port, servername: config.host })
        : connectNet({ host: config.host, port: config.port })
      const readyEvent = config.ssl ? 'secureConnect' : 'connect'
      const timer = setTimeout(() => {
        socket.destroy()
        reject(new BadRequestException('SMTP 连接超时'))
      }, CONNECT_TIMEOUT_MS)
      socket.once('error', (error) => {
        clearTimeout(timer)
        reject(new BadRequestException(`SMTP 连接失败：${error.message}`))
      })
      socket.once(readyEvent, () => {
        clearTimeout(timer)
        socket.setTimeout(CONNECT_TIMEOUT_MS)
        resolve(socket)
      })
    })
  }

  private upgradeTls(socket: SmtpSocket, host: string): Promise<TLSSocket> {
    return new Promise((resolve, reject) => {
      socket.removeAllListeners('data')
      const secure = connectTls({ socket: socket as Socket, servername: host })
      const timer = setTimeout(() => {
        secure.destroy()
        reject(new BadRequestException('SMTP TLS 握手超时'))
      }, CONNECT_TIMEOUT_MS)
      secure.once('error', (error) => {
        clearTimeout(timer)
        reject(new BadRequestException(`SMTP TLS 握手失败：${error.message}`))
      })
      secure.once('secureConnect', () => {
        clearTimeout(timer)
        secure.setTimeout(CONNECT_TIMEOUT_MS)
        resolve(secure)
      })
    })
  }

  private async authenticate(
    socket: SmtpSocket,
    ehlo: SmtpResponse,
    account: string,
    password: string,
  ) {
    const authLine = ehlo.lines.find((line) => /AUTH(?:=|\s)/i.test(line))?.toUpperCase() ?? ''
    if (authLine.includes('PLAIN')) {
      const payload = Buffer.from(`\0${account}\0${password}`).toString('base64')
      await this.command(socket, `AUTH PLAIN ${payload}`, [235], 'SMTP 账号或密码验证失败')
      return
    }
    if (authLine.includes('LOGIN')) {
      await this.command(socket, 'AUTH LOGIN', [334], 'SMTP AUTH LOGIN 不可用')
      await this.command(
        socket,
        Buffer.from(account).toString('base64'),
        [334],
        'SMTP 账号验证失败',
      )
      await this.command(
        socket,
        Buffer.from(password).toString('base64'),
        [235],
        'SMTP 密码验证失败',
      )
      return
    }
    throw new BadRequestException('SMTP 服务未声明支持 AUTH PLAIN/LOGIN')
  }

  private async command(
    socket: SmtpSocket,
    command: string,
    acceptedCodes: number[],
    message: string,
  ) {
    socket.write(`${command}\r\n`)
    return this.expect(socket, acceptedCodes, message)
  }

  private async expect(socket: SmtpSocket, acceptedCodes: number[], message: string) {
    const response = await this.readResponse(socket)
    if (!acceptedCodes.includes(response.code)) {
      const serverMessage = response.lines
        .join(' ')
        .replace(/^\d{3}[ -]?/, '')
        .trim()
      throw new BadRequestException(`${message}${serverMessage ? `：${serverMessage}` : ''}`)
    }
    return response
  }

  private readResponse(socket: SmtpSocket): Promise<SmtpResponse> {
    return new Promise((resolve, reject) => {
      let buffer = ''
      const lines: string[] = []
      let responseCode: number | null = null

      const cleanup = () => {
        socket.off('data', onData)
        socket.off('error', onError)
        socket.off('timeout', onTimeout)
      }
      const onError = (error: Error) => {
        cleanup()
        reject(new BadRequestException(`SMTP 通信失败：${error.message}`))
      }
      const onTimeout = () => {
        cleanup()
        reject(new BadRequestException('SMTP 响应超时'))
      }
      const onData = (chunk: Buffer) => {
        buffer += chunk.toString('utf8')
        while (buffer.includes('\n')) {
          const newline = buffer.indexOf('\n')
          const line = buffer.slice(0, newline).replace(/\r$/, '')
          buffer = buffer.slice(newline + 1)
          const match = line.match(/^(\d{3})([ -])(.*)$/)
          if (!match) continue
          const code = Number(match[1])
          responseCode ??= code
          lines.push(line)
          if (match[2] === ' ' && code === responseCode) {
            cleanup()
            resolve({ code, lines })
            return
          }
        }
      }

      socket.on('data', onData)
      socket.once('error', onError)
      socket.once('timeout', onTimeout)
    })
  }
}
