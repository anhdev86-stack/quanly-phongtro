import { Module } from '@nestjs/common';
import { BillingController } from './billing/billing.controller.js';
import { BillingMoveInExtension } from './billing/billing-move-in.js';
import { BillingService, INVOICE_SETTLEMENT, NoSettlements } from './billing/billing.service.js';
import { ChargeCalculator } from './billing/charges.js';
import { ContractDepositRequirement, ContractMoveInExtension, ContractRentalMode } from './contracts/contract-providers.js';
import { ContractsController } from './contracts/contracts.controller.js';
import { ContractsService } from './contracts/contracts.service.js';
import { BuildingsController } from './buildings/buildings.controller.js';
import { BuildingsService } from './buildings/buildings.service.js';
import { LedgersController } from './ledgers/ledgers.controller.js';
import { DEPOSIT_REQUIREMENT, LedgersService } from './ledgers/ledgers.service.js';
import { DefaultReservationExtras } from './reservations/reservation-extras.js';
import { ReservationsController } from './reservations/reservations.controller.js';
import { RESERVATION_EXTRAS, ReservationsService } from './reservations/reservations.service.js';
import { RoomsController } from './rooms/rooms.controller.js';
import { RoomsService } from './rooms/rooms.service.js';
import { ServicesCatalogController } from './services/services.controller.js';
import { MembersService } from './tenancies/members.service.js';
import { TenanciesController } from './tenancies/tenancies.controller.js';
import { MOVE_IN_EXTENSIONS, RENTAL_MODE, TenanciesService } from './tenancies/tenancies.service.js';
import { TenantsController } from './tenants/tenants.controller.js';
import { TenantsService } from './tenants/tenants.service.js';
import { UsersController } from './users/users.controller.js';
import { UsersService } from './users/users.service.js';
import { MetersService } from './utilities/meters.service.js';
import { PricesService } from './utilities/prices.service.js';
import { SettingsService } from './utilities/settings.service.js';
import { SubscriptionsService } from './utilities/subscriptions.service.js';
import { UtilitiesController } from './utilities/utilities.controller.js';

/**
 * Các nghiệp vụ phụ thuộc chéo nhau (phòng ↔ giữ chỗ ↔ cọc ↔ lần thuê ↔ tính phí) nên nằm chung một module DI.
 * Mỗi phase bổ sung controller/service và thay các provider mở rộng (RESERVATION_EXTRAS, DEPOSIT_REQUIREMENT…).
 */
@Module({
  controllers: [
    BuildingsController,
    RoomsController,
    ReservationsController,
    UsersController,
    TenantsController,
    TenanciesController,
    LedgersController,
    ServicesCatalogController,
    ContractsController,
    UtilitiesController,
    BillingController,
  ],
  providers: [
    BuildingsService,
    RoomsService,
    ReservationsService,
    UsersService,
    TenantsService,
    TenanciesService,
    MembersService,
    LedgersService,
    ContractsService,
    ContractMoveInExtension,
    SettingsService,
    PricesService,
    MetersService,
    SubscriptionsService,
    ChargeCalculator,
    BillingService,
    BillingMoveInExtension,
    { provide: INVOICE_SETTLEMENT, useClass: NoSettlements },
    { provide: RESERVATION_EXTRAS, useClass: DefaultReservationExtras },
    { provide: DEPOSIT_REQUIREMENT, useClass: ContractDepositRequirement },
    { provide: RENTAL_MODE, useClass: ContractRentalMode },
    {
      provide: MOVE_IN_EXTENSIONS,
      // Thứ tự: hợp đồng (có thể đặt giá theo hợp đồng) trước, rồi thông báo đầu tiên.
      useFactory: (contract: ContractMoveInExtension, billing: BillingMoveInExtension) => [contract, billing],
      inject: [ContractMoveInExtension, BillingMoveInExtension],
    },
  ],
})
export class BusinessModule {}
