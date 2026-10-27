import { Module } from '@nestjs/common';
import { NotificationsModule } from '../../modules/notifications/notifications.module.js';
import { ResendChannel } from './resend.channel.js';

@Module({
  imports: [NotificationsModule],
  providers: [ResendChannel],
})
export class EmailModule {}
