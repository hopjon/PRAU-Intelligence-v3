const routes = {};

export function registerRoute(name, callback) {
    routes[name] = callback;
}

export function navigate(name) {

    if (!routes[name]) {
        console.error("Route not found:", name);
        return;
    }

    routes[name]();

}