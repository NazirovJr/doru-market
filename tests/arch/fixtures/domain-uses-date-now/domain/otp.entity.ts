export class OtpEntity {
  readonly issuedAtMs: number

  constructor() {
    this.issuedAtMs = Date.now()
  }
}
