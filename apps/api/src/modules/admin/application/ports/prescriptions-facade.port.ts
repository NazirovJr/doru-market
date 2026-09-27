// Модуль prescriptions ещё не существует — бинд через useClass: NullPrescriptionsFacadeAdapter, не useExisting.
export const PRESCRIPTIONS_FACADE_PORT = Symbol.for('@dorutj/admin/prescriptions-facade-port')

export interface PrescriptionMetaView {
  readonly prescriptionId: string
  readonly status: string
}

export interface PrescriptionsFacadePort {
  getPrescriptionMetaByOrder(orderId: string): Promise<PrescriptionMetaView | null>
}
