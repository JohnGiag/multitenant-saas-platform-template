import { Module } from '@nestjs/common';
import { NotificationsModule } from '../../modules/notifications/notifications.module.js';
import { FcmChannel } from './fcm.channel.js';
import { PushDevicesController } from './push-devices.controller.js';

@Module({
  imports: [NotificationsModule],
  controllers: [PushDevicesController],
  providers: [FcmChannel],
})
export class PushModule {}
