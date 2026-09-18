import { Module } from '@nestjs/common'
import { JwtModule } from '@nestjs/jwt'
import { Prisma8Module } from '../prisma/prisma8.module.js'
import { AuthController } from './auth.controller'
import { AuthService } from './auth.service'

@Module({
  // JwtService 全局可用（签发/校验时显式传入各自的密钥）
  imports: [Prisma8Module, JwtModule.register({ global: true })],
  controllers: [AuthController],
  providers: [AuthService],
  exports: [AuthService],
})
export class AuthModule {}
