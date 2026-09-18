import { Module } from '@nestjs/common'
import { Prisma8Service } from './prisma8.service.js'

@Module({
  providers: [Prisma8Service],
  exports: [Prisma8Service],
})
export class Prisma8Module {}
