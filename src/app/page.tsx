import Chat from "@/components/Chat";

export default function Home() {
  return (
    <main className="h-screen bg-zinc-950 text-zinc-100 flex flex-col">
      {/* Header */}
      <header className="border-b border-zinc-800 px-4 py-3 bg-zinc-950/80 backdrop-blur-sm">
        <div className="max-w-3xl mx-auto flex items-center gap-3">
          <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center text-sm font-bold">
            H
          </div>
          <div>
            <h1 className="text-sm font-semibold">HaaS Chat</h1>
            <p className="text-xs text-zinc-500">
              Execute code in isolated containers
            </p>
          </div>
        </div>
      </header>

      {/* Chat */}
      <div className="flex-1 overflow-hidden">
        <Chat />
      </div>
    </main>
  );
}
