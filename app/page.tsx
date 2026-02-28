import BeatBox from "@/components/beatbox"

export default function Page() {
  return (
    <main className="min-h-[100dvh] w-full bg-gradient-to-b from-white to-neutral-50 dark:from-neutral-950 dark:to-neutral-900 text-neutral-900 dark:text-neutral-100">
      <section className="mx-auto max-w-5xl px-4 py-8 md:py-24">
        <BeatBox defaultBpm={132} />
      </section>
      <footer className="mx-auto max-w-5xl px-4 pb-10 text-center text-xs text-neutral-500 dark:text-neutral-400">
        {'Tip: Press Play to initialize audio. You can edit steps live while the beat is running.'}
      </footer>
    </main>
  )
}
