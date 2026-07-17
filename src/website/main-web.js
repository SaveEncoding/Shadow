async function handleWebsiteUpdate(request) {
    return env.ASSETS.fetch(request);
}