/** Anything with the `pusher` package's auth methods. */
export interface Authorizer {
  authorizeChannel(socketId: string, channel: string, data?: { user_id: string; user_info?: any }): any;
  authenticateUser(socketId: string, user: { id: string; [key: string]: any }): any;
}

/** What a handler is called with: SvelteKit's RequestEvent, or anything with a `request`. */
export interface HandlerEvent {
  request: Request;
  [key: string]: any;
}

export interface PresenceMember<Info = any> {
  user_id: string | number;
  user_info?: Info;
}

type MaybePromise<T> = T | Promise<T>;

/**
 * A POST handler for pusher-js channelAuthorization. Return false/null to
 * refuse (403), true for a private channel, the member for a presence channel.
 */
export function channelAuth<E extends HandlerEvent = HandlerEvent>(
  pusher: Pick<Authorizer, 'authorizeChannel'>,
  authorize: (event: E, request: { channelName: string; socketId: string }) => MaybePromise<boolean | PresenceMember | null | undefined>,
): (event: E) => Promise<Response>;

/** A POST handler for pusher-js userAuthentication (pusher.signin()). */
export function userAuth<E extends HandlerEvent = HandlerEvent>(
  pusher: Pick<Authorizer, 'authenticateUser'>,
  authenticate: (event: E, request: { socketId: string }) => MaybePromise<{ id: string | number; [key: string]: any } | false | null | undefined>,
): (event: E) => Promise<Response>;
