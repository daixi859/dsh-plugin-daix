/**
 * The shared pass queue: work is scheduled into a read phase and a write
 * phase of one animation frame, so a burst of DOM changes costs one pass and
 * a measure never lands between two writes.
 */
type Phase = 'read' | 'write'

const queues: Record<Phase, Set<() => void>> = { read: new Set(), write: new Set() }
let frame: number | null = null

function run(phase: Phase): void {
  const queue = queues[phase]
  const jobs = [...queue]
  queue.clear()
  for (const job of jobs) {
    try {
      job()
    } catch (error) {
      console.error(`[${'dsh-claude-lite'}] ${phase} pass:`, error)
    }
  }
}

function flush(): void {
  frame = null
  run('read')
  run('write')
}

/**
 * Schedule a job for the next pass. Reads run before writes, so a job that
 * measures always sees the frame's starting layout.
 */
export function schedulePass(phase: Phase, job: () => void): void {
  queues[phase].add(job)
  if (frame === null) frame = requestAnimationFrame(flush)
}
