export async function handleWebsiteUpdate(request, env) {
    return env.ASSETS.fetch(request);
}