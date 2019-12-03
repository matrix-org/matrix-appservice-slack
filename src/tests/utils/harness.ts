import { AppServiceRegistration } from "matrix-appservice";
import { Main } from "../../Main";

export function constructHarness() {
    const reg = new AppServiceRegistration("foobar");
    reg.setHomeserverToken(AppServiceRegistration.generateToken());
    reg.setAppServiceToken(AppServiceRegistration.generateToken());
    reg.setSenderLocalpart("test_bot");
    reg.setId("foobar");
    const main = new Main({
        matrix_admin_room: "!admin_room:foobar",
        username_prefix: "test_",
        homeserver: {
            url: "https://localhost",
            server_name: "foobar",
        },
        enable_metrics: false,
        dbdir: "/tmp",
        logging: {
            console: "info",
        },
        rtm: {
            enable: true,
        },
    }, reg);
    // tslint:disable-next-line: no-any
    (main as any).bridge.getBot = () => ({
       getJoinedRooms: () => Promise.resolve([]),
       getUserId: () => "@bot:foobar",
    });
    return { main };
}
