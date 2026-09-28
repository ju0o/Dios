import { count, dollars, type WeekGraph } from '../../core/agent-monitor/usage-summary'

interface WeekBarsProps {
  graph: WeekGraph
  /** Bars of several graphs share this height so projects compare fairly. Defaults to the graph's own peak. */
  peak?: number
  /** Hide the legend when a caption already names the agents. */
  compact?: boolean
}

/** Bars for the last seven days. Money agents share one scale; Cursor shows chats as small numbers. */
export function WeekBars({ graph, peak, compact = false }: WeekBarsProps) {
  const money = graph.agents.filter((agent) => agent.id !== 'cursor')
  const cursor = graph.agents.find((agent) => agent.id === 'cursor')
  const top = Math.max(peak ?? graph.peak, 0.0001)
  return (
    <div className="week-graph" role="img" aria-label={graph.sentence}>
      <div className="week-columns">
        {graph.days.map((day, index) => (
          <div key={day} className="week-column">
            <div className="week-stack">
              {money.map((agent) => (
                <i key={agent.id} className={`week-bar is-${agent.id}`} style={{ height: `${Math.round((agent.days[index] / top) * 100)}%` }} title={`${agent.title} ${dollars(agent.days[index])}`} />
              ))}
            </div>
            {cursor && cursor.days[index] > 0 && <small className="week-chats" title={`Cursor 대화 ${count(cursor.days[index])}번`}>{count(cursor.days[index])}</small>}
            <span className={`week-label ${index === graph.days.length - 1 ? 'is-today' : ''}`}>{graph.labels[index]}</span>
          </div>
        ))}
      </div>
      {!compact && (
        <ul className="week-legend">
          {money.map((agent) => (
            <li key={agent.id}><i className={`week-dot is-${agent.id}`} />{agent.title} 약 {dollars(agent.week)}{agent.share > 0 ? ` · ${Math.round(agent.share * 100)}%` : ''}</li>
          ))}
          {cursor && <li><i className="week-dot is-cursor" />Cursor 대화 {count(cursor.week)}번</li>}
        </ul>
      )}
    </div>
  )
}
