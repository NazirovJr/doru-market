import { type ReactElement } from 'react'
import { Outlet } from 'react-router'

export const AppLayout = (): ReactElement => (
  <div className="admin-shell">
    <header className="admin-header">
      <h1>DoruTJ Admin</h1>
    </header>
    <main className="admin-main">
      <Outlet />
    </main>
  </div>
)
