/** Shared dynamic imports so prefetch and React.lazy hit the same module cache. */
export const routeLoaders = {
  feed: () => import('../pages/Feed'),
  explore: () => import('../pages/Explore'),
  messages: () => import('../pages/Messages'),
  newMessage: () => import('../pages/NewMessage'),
  chat: () => import('../pages/Chat'),
  activity: () => import('../pages/Activity'),
  profile: () => import('../pages/Profile'),
  settings: () => import('../pages/Settings'),
  compose: () => import('../components/ComposeSheet'),
}

const loaders = Object.values(routeLoaders)

export function prefetchAppRoutes() {
  for (const load of loaders) void load()
}

export function prefetchPath(path: string) {
  if (path === '/app' || path === '/app/') void routeLoaders.feed()
  else if (path.startsWith('/app/messages/new')) void routeLoaders.newMessage()
  else if (path.startsWith('/app/messages/')) void routeLoaders.chat()
  else if (path.startsWith('/app/messages')) void routeLoaders.messages()
  else if (path.startsWith('/app/activity')) void routeLoaders.activity()
  else if (path.startsWith('/app/profile') || path.startsWith('/app/u/')) void routeLoaders.profile()
  else if (path.startsWith('/app/explore')) void routeLoaders.explore()
  else if (path.startsWith('/app/settings')) void routeLoaders.settings()
  else if (path.startsWith('/app/compose')) void routeLoaders.compose()
}
