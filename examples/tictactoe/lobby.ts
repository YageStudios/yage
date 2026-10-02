import { Button, Column, Panel, Row, TextInput, Text, UIFinal, signal, when } from "yage/ui/final";

export interface TictactoeLobbyChoice {
    mode: "local" | "host" | "join";
    code?: string;
}

const CODE_ALPHABET = "234579ACDEFGHJKMNPQRTWXYZ";

const randomCode = (): string =>
    Array.from({ length: 5 }, () => CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)]).join("");

/**
 * Start screen built on YAGE UI Final: shared-keyboard hot-seat against a
 * friend on this machine, or online over a peer room under a shareable code.
 * Whoever opens a code first hosts; the other side joins by the same code.
 */
export function showTictactoeLobby(onStart: (choice: TictactoeLobbyChoice) => void): UIFinal {
    const hosting = signal(false);
    const code = signal(randomCode());
    const joinCode = signal("");
    const error = signal("");

    const ui = new UIFinal();
    const begin = (choice: TictactoeLobbyChoice) => {
        ui.dispose();
        onStart(choice);
    };
    const join = () => {
        const typed = joinCode.get().trim().toUpperCase();
        if (typed.length < 3) {
            error.set("Enter the room code shown on the other screen.");
            return;
        }
        begin({ mode: "join", code: typed });
    };

    ui.mount(
        Panel({
            style: {
                position: "absolute", inset: 0, display: "grid", placeItems: "center",
                background: "radial-gradient(ellipse at 50% 30%, #1c3350 0%, #0d1626 75%)",
            },
        },
            Column({
                style: {
                    alignItems: "center", gap: 16, padding: 34, minWidth: 340,
                    background: "rgba(13, 22, 38, 0.92)", borderRadius: 14, border: "1px solid #2c4668",
                },
            },
                Text("TIC · TAC · TOE", {
                    role: "heading",
                    attrs: { "aria-level": 1 },
                    style: { fontSize: 38, color: "#ffffff", letterSpacing: 3 },
                }),
                Text("X versus O — first to three in a row.", {
                    style: { fontSize: 13, color: "#9fb8d8" },
                }),
                when(() => error.get() !== "", () =>
                    Text(() => error.get(), { style: { fontSize: 13, color: "#ff9c9c" } })),
                when(() => !hosting.get(), () =>
                    Column({ style: { alignItems: "stretch", gap: 12 } },
                        Button({
                            style: { minHeight: 46, fontSize: 16 },
                            on: { activate: () => begin({ mode: "local" }) },
                        }, "Play local (shared keyboard)"),
                        Button({
                            style: { minHeight: 46, fontSize: 16 },
                            on: { activate: () => { error.set(""); hosting.set(true); } },
                        }, "Host an online game"),
                        Row({ style: { gap: 8, alignItems: "center" } },
                            TextInput({
                                bindValue: joinCode,
                                placeholder: "Room code",
                                maxLength: 5,
                                style: { textTransform: "uppercase", flex: 1 },
                            }),
                            Button({
                                style: { minHeight: 42 },
                                on: { activate: join },
                            }, "Join")))),
                when(() => hosting.get(), () =>
                    Column({ style: { alignItems: "center", gap: 12 } },
                        Text("Share this room code", { style: { fontSize: 13, color: "#9fb8d8" } }),
                        Text(() => code.get(), {
                            style: { fontSize: 40, letterSpacing: 6, color: "#8fd4ff", fontWeight: 700 },
                        }),
                        Row({ style: { gap: 10 } },
                            Button({
                                style: { minHeight: 46 },
                                on: { activate: () => code.set(randomCode()) },
                            }, "New code"),
                            Button({
                                style: { minHeight: 46, fontSize: 15 },
                                on: { activate: () => begin({ mode: "host", code: code.get() }) },
                            }, "Start the game")))))));
    return ui;
}
