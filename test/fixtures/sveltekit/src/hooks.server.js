// A stand-in for real sign-in: ?user=ann on the first visit sets a cookie.
const USERS = { ann: 'Ann', bo: 'Bo' };

export async function handle({ event, resolve }) {
  const asked = event.url.searchParams.get('user');
  if (asked && USERS[asked]) event.cookies.set('user', asked, { path: '/', httpOnly: true, sameSite: 'lax', secure: false });
  const id = asked ?? event.cookies.get('user');
  event.locals.user = id && USERS[id] ? { id, name: USERS[id] } : null;
  return resolve(event);
}
