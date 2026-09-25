// Своя копия apps/api DeliveryOfferTimeoutJobData — apps/worker не импортирует код apps/api напрямую.
export interface DeliveryOfferTimeoutJobData {
  readonly offerId: string
}
