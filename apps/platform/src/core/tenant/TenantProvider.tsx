import React from 'react'

interface TenantProviderProps {
  children: React.ReactNode
}

export const TenantProvider: React.FC<TenantProviderProps> = ({ children }) => {
  return <>{children}</>
}
