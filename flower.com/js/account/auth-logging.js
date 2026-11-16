export function logAuthError(context, error) {
    const code = typeof error?.code === "string"
        && error.code.length <= 100
        && /^(?:auth|app)\/[a-z0-9-]+$/i.test(error.code)
        ? error.code
        : "unknown";
    console.error(context, code);
}
