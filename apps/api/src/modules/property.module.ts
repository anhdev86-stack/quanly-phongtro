import { Module } from '@nestjs/common';
import { BuildingsController } from './buildings/buildings.controller.js';
import { BuildingsService } from './buildings/buildings.service.js';
import { DefaultReservationExtras } from './reservations/reservation-extras.js';
import { ReservationsController } from './reservations/reservations.controller.js';
import { RESERVATION_EXTRAS, ReservationsService } from './reservations/reservations.service.js';
import { RoomsController } from './rooms/rooms.controller.js';
import { RoomsService } from './rooms/rooms.service.js';
import { UsersController } from './users/users.controller.js';
import { UsersService } from './users/users.service.js';

/** Phase 1: tòa, phòng, giữ phòng, người dùng. */
@Module({
  controllers: [BuildingsController, RoomsController, ReservationsController, UsersController],
  providers: [
    BuildingsService,
    RoomsService,
    ReservationsService,
    UsersService,
    { provide: RESERVATION_EXTRAS, useClass: DefaultReservationExtras },
  ],
  exports: [BuildingsService, RoomsService, ReservationsService],
})
export class PropertyModule {}
