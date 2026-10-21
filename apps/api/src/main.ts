import { ValidationPipe } from '@nestjs/common'
import { NestFactory } from '@nestjs/core'
import type { NestExpressApplication } from '@nestjs/platform-express'
import { AppModule } from './app.module'
import { parseTrustProxyHops } from './common/http/client-ip'
import { setupSwagger } from './swagger'

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule)
  app.enableShutdownHooks()
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

  // 生产环境始终关闭 API 文档；开发环境需显式设置 SWAGGER_ENABLED=true 才启用。
  if (process.env.NODE_ENV !== 'production' && process.env.SWAGGER_ENABLED === 'true') {
    setupSwagger(app)
  }

  const port = Number(process.env.PORT ?? 3000)
  await app.listen(port)
  console.log(`API 已启动: http://localhost:${port}/api`)
}

void bootstrap()
