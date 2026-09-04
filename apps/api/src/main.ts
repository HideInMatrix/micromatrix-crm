import { ValidationPipe } from '@nestjs/common'
import { NestFactory } from '@nestjs/core'
import type { NestExpressApplication } from '@nestjs/platform-express'
import { AppModule } from './app.module'
import { parseTrustProxyHops } from './common/http/client-ip'
import { setupSwagger } from './swagger'

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule)
  app.set('trust proxy', parseTrustProxyHops(process.env.TRUST_PROXY_HOPS))

  app.setGlobalPrefix('api')
  app.enableCors()
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  )

  // 内部系统：文档常开；如需关闭设置 SWAGGER_ENABLED=false
  if (process.env.SWAGGER_ENABLED !== 'false') {
    setupSwagger(app)
  }

  const port = Number(process.env.PORT ?? 3000)
  await app.listen(port)
  console.log(`API 已启动: http://localhost:${port}/api  文档: http://localhost:${port}/api/docs`)
}

void bootstrap()
