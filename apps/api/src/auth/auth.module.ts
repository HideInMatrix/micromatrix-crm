import { Module } from '@nestjs/common'
import { JwtModule } from '@nestjs/jwt'
import { PrismaModule } from '../prisma/prisma.module.js'
import { AuthController } from './auth.controller'
import { AuthService } from './auth.service'

@Module({
  // JwtService 全局可用（签发/校验时显式传入各自的密钥）
  imports: [PrismaModule, JwtModule.register({ global: true })],
  controllers: [AuthController],
  providers: [AuthService],
  exports: [AuthService],
})
export class AuthModule {}
