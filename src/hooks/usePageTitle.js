import { useEffect } from 'react'

// document.title never changed per route before this — every page kept
// index.html's root title, which means the browser tab (and whatever a
// screen reader announces on navigation) never actually told you which
// page you were on, and public pages had no distinct title for social
// sharing. react-router-dom doesn't manage this for you; each page calls
// this hook once with its own title.
const SITE_TITLE = 'senseUS — real humans. real opinions. real truth.'

export function usePageTitle(title) {
  useEffect(() => {
    document.title = title ? `${title} — senseUS` : SITE_TITLE
    return () => {
      document.title = SITE_TITLE
    }
  }, [title])
}
