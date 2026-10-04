import s from '../Research.module.css'

export function Bottleneck() {
  return (
    <>
      <section className={s.s} id="s1">
        <p className={s.sN}>1 · The coordination layer</p>
        <h2>Software development isn’t solved. Its bottleneck is moving.</h2>
        <div className={s.prose}>
          <p>
            The basic unit of AI-assisted development has been a conversation: describe a task, inspect the result, correct the agent,
            repeat. As agents improved, the industry multiplied that unit. Developers now run several chats, terminals, worktrees or cloud
            sessions in parallel.
          </p>
          <p>
            That adds throughput, but it doesn’t add up to a coherent project. Each session has a partial view. The developer remains
            responsible for remembering which agent knows what, which branch holds which decision, which review applies to which revision,
            and which apparent completion was actually tested.
          </p>
          <p>
            The result is a curious kind of automation. Machines do more of the work, while the human spends more of the day supervising
            queues, carrying context and reconnecting processes the software treats as unrelated.
          </p>
          <p>
            The central question is no longer “can an agent write the code?” It is{' '}
            <em>
              “can the project keep its intent and move the work to a trustworthy result, without a developer conducting every transition by
              hand?”
            </em>{' '}
            Althar treats this as one problem with two halves: memory and ownership, and attention and orchestration.
          </p>
        </div>
      </section>
    </>
  )
}
