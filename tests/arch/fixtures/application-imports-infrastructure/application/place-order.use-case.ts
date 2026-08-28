import { OrderRepository } from '../infrastructure/order-repository'

export class PlaceOrderUseCase {
  constructor(private readonly repository: OrderRepository) {}

  execute(orderId: string): string {
    return this.repository.findById(orderId)
  }
}
