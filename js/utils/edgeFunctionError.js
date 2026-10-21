// supabase-js's functions.invoke() only gives a generic "Edge Function
// returned a non-2xx status code" in error.message -- the real reason
// (the JSON body that function's own error responses carry) is on
// error.context, a raw Response object whose body hasn't been read yet.
export async function extractFunctionErrorMessage(error) {
  if (!error) return 'Unknown error';
  try {
    const body = await error.context?.clone().json();
    if (body?.error) return body.error;
  } catch { /* context wasn't JSON (e.g. a network failure) -- fall through */ }
  return error.message || 'Unknown error';
}
