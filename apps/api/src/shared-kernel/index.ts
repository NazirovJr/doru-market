/**
 * Public barrel `shared-kernel` (D-27). Другие модули импортируют порты
 * `Clock`/`IdGenerator` ТОЛЬКО через эту точку (`02-CLEAN-ARCHITECTURE-AND-CODE.md` §1.2).
 */
export { CLOCK, type Clock } from './application/ports/clock.port.js'
export { ID_GENERATOR, type IdGenerator } from './application/ports/id-generator.port.js'
export { SharedKernelModule } from './shared-kernel.module.js'
