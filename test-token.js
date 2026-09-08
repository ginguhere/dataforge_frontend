import { TokenSource } from "livekit-client";

const tokenSource = TokenSource.developmentTokenServer(
    "YOUR_TOKEN_SERVER_ID"
);

const result = await tokenSource.fetch({
    roomName: "dataforge-test",
    agentName: "dataforge",
});

console.log(result);