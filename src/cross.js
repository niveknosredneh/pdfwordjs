export const fn = {};

export function register(name, func) {
    fn[name] = func;
}
