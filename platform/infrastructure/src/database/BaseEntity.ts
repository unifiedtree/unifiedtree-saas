export interface BaseEntity {
  id: string        // UUID
  createdAt: string // ISO timestamp
  updatedAt: string // ISO timestamp
}

export interface TenantEntity extends BaseEntity {
  tenantId: string
}

export interface IRepository<T extends BaseEntity> {
  findById(id: string): Promise<T | null>
  findAll(params?: { page?: number; size?: number }): Promise<{ content: T[]; total: number }>
  create(data: Omit<T, keyof BaseEntity>): Promise<T>
  update(id: string, data: Partial<T>): Promise<T>
  delete(id: string): Promise<void>
  exists(id: string): Promise<boolean>
}

export interface ITenantRepository<T extends TenantEntity> extends IRepository<T> {
  findByTenantId(
    tenantId: string,
    params?: { page?: number; size?: number }
  ): Promise<{ content: T[]; total: number }>
  findByIdAndTenantId(id: string, tenantId: string): Promise<T | null>
  countByTenantId(tenantId: string): Promise<number>
  deleteByTenantId(tenantId: string): Promise<void>
}
