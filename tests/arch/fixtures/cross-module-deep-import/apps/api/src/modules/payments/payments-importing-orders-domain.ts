// Нарушение §1.2: платежи лезут во внутренности заказов в обход публичного фасада
// modules/orders/index.ts — так делать нельзя.
import { OrderEntity } from '../orders/domain/order.entity'

export const describeOrder = (order: OrderEntity): string => order.id
