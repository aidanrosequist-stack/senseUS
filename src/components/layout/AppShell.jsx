import { Outlet } from 'react-router-dom'
import Header from './Header'
import BottomNav from './BottomNav'

// Shared chrome for every logged-in app page (Vote, Explore, Activity,
// Profile, Conversation, Compare, MakeUpMyMind, Notifications).
//
// This is the fix for the header/footer remounting on every navigation:
// previously each page imported and rendered its own <Header />/<BottomNav />,
// so React Router tore both down and rebuilt them on every single route
// change (position: fixed on BottomNav just made that invisible — it still
// happened underneath). Because this component sits on a *parent* route
// with an <Outlet /> for the page content, React Router keeps it mounted
// across navigation between any of the child routes below — only the
// outlet's content swaps. Header and BottomNav are each created once per
// app session, not once per click.
export default function AppShell() {
  return (
    <>
      <Header />
      <Outlet />
      <BottomNav />
    </>
  )
}
