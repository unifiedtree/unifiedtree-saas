import React from 'react'
import { useAuthStore as useSdkStore } from '@unifiedtree/sdk'
import { Button } from '@/design/kit/display'
import { dashIcon } from '@/design/dc/icons'
import '@/design/shell/shell.css'

/**
 * /no-access: someone signed in who can't open any page of this workspace (no roles, or roles that
 * open no page). The only way on is to ask an administrator, or to sign out.
 */
export const NoAccess: React.FC = () => {
  const logout = useSdkStore(s => s.logout)

  return (
    <main className="ut-noaccess">
      <section className="ut-noaccess__card" aria-labelledby="ut-noaccess-title">
        <span className="ut-noaccess__icon" aria-hidden="true">{dashIcon('lock', 26)}</span>
        <h1 id="ut-noaccess-title" className="ut-noaccess__title">No access yet</h1>
        <p className="ut-noaccess__text">Your account can’t open any page in this workspace yet. Ask your administrator to give you access.</p>
        <Button variant="primary" size={40} icon="logOut" onClick={() => { void logout() }}>Sign out</Button>
      </section>
    </main>
  )
}
