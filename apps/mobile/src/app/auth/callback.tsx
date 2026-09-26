import { Redirect } from 'expo-router';

/**
 * Landing route for the sign-in deep link (gozali://auth/callback). The browser session hands the
 * code to the sign-in flow; if the link also reaches the router, just go home.
 */
export default function AuthCallback() {
  return <Redirect href="/" />;
}
