import { useEffect, useRef, useState } from 'react'

import { formatSeconds } from '../formatters/time'

function normalizeCc(value) {
  const cc = Number(value)
  if (!Number.isFinite(cc)) return 0
  return Math.max(0, Math.min(127, Math.round(cc)))
}

export function CheckpointPanel({
  groups,
  selectedGroupId,
  activeCheckpoints,
  activeCheckpoint,
  midiControls,
  status,
  onSelectGroup,
  onCreateGroup,
  onDeleteGroup,
  onAddCheckpoint,
  onUpdateCheckpoint,
  onDeleteCheckpoint,
  onUpdateMidiControls,
  onSeekCheckpoint,
  onNextCheckpoint,
  onPrevCheckpoint,
}) {
  const [newGroupName, setNewGroupName] = useState('')
  const [newCheckpointLabel, setNewCheckpointLabel] = useState('')
  const [midiState, setMidiState] = useState({ type: 'idle', message: 'MIDI no activado', lastCc: null })
  const midiAccessRef = useRef(null)
  const latestHandlersRef = useRef({ onNextCheckpoint, onPrevCheckpoint, midiControls })

  useEffect(() => {
    latestHandlersRef.current = { onNextCheckpoint, onPrevCheckpoint, midiControls }
  }, [midiControls, onNextCheckpoint, onPrevCheckpoint])

  useEffect(() => {
    return () => {
      const midiAccess = midiAccessRef.current
      if (!midiAccess) return
      for (const input of midiAccess.inputs.values()) {
        input.onmidimessage = null
      }
    }
  }, [])

  async function handleCreateGroup(event) {
    event.preventDefault()
    const name = newGroupName.trim()
    if (!name) return
    const group = await onCreateGroup(name)
    if (group?.id) onSelectGroup(group.id)
    setNewGroupName('')
  }

  async function handleAddCheckpoint(event) {
    event.preventDefault()
    const label = newCheckpointLabel.trim() || `Checkpoint ${activeCheckpoints.length + 1}`
    await onAddCheckpoint(label)
    setNewCheckpointLabel('')
  }

  async function handleMidiSubmit(event) {
    event.preventDefault()
    const formData = new FormData(event.currentTarget)
    await onUpdateMidiControls({
      nextCc: normalizeCc(formData.get('nextCc')),
      prevCc: normalizeCc(formData.get('prevCc')),
    })
  }

  async function activateMidi() {
    if (!navigator.requestMIDIAccess) {
      setMidiState({ type: 'error', message: 'Este navegador no soporta Web MIDI', lastCc: null })
      return
    }

    try {
      const midiAccess = await navigator.requestMIDIAccess()
      midiAccessRef.current = midiAccess

      const handleMessage = (event) => {
        const [statusByte, controller, value] = event.data
        const messageType = statusByte & 0xf0
        if (messageType !== 0xb0) return

        const { midiControls: currentControls, onNextCheckpoint: next, onPrevCheckpoint: prev } = latestHandlersRef.current
        setMidiState({
          type: 'connected',
          message: `CC ${controller} valor ${value}`,
          lastCc: controller,
        })

        if (controller === Number(currentControls.nextCc)) next()
        if (controller === Number(currentControls.prevCc)) prev()
      }

      for (const input of midiAccess.inputs.values()) {
        input.onmidimessage = handleMessage
      }

      midiAccess.onstatechange = () => {
        for (const input of midiAccess.inputs.values()) {
          input.onmidimessage = handleMessage
        }
      }

      setMidiState({
        type: 'connected',
        message: midiAccess.inputs.size ? 'MIDI conectado' : 'MIDI activo, sin entradas detectadas',
        lastCc: null,
      })
    } catch (error) {
      setMidiState({ type: 'error', message: error.message ?? 'No se pudo activar MIDI', lastCc: null })
    }
  }

  return (
    <section className="checkpoint-panel" aria-label="Checkpoints de la canción">
      <div className="checkpoint-header">
        <div>
          <p className="checkpoint-label">Checkpoints</p>
          <p className="checkpoint-current">
            Actual: {activeCheckpoint ? `${activeCheckpoint.label} (${formatSeconds(activeCheckpoint.time)})` : 'sin checkpoint'}
          </p>
        </div>
        <div className="checkpoint-nav">
          <button type="button" onClick={onPrevCheckpoint} disabled={!activeCheckpoints.length}>
            Prev
          </button>
          <button type="button" onClick={onNextCheckpoint} disabled={!activeCheckpoints.length}>
            Next
          </button>
        </div>
      </div>

      {status.message && <p className={`checkpoint-status is-${status.type}`}>{status.message}</p>}

      <div className="checkpoint-grid">
        <div className="checkpoint-groups">
          <label>
            Grupo
            <select
              value={selectedGroupId ?? ''}
              onChange={(event) => onSelectGroup(event.target.value ? Number(event.target.value) : null)}
            >
              <option value="">Sin grupo</option>
              {groups.map((group) => (
                <option key={group.id} value={group.id}>
                  {group.name}
                </option>
              ))}
            </select>
          </label>
          <form className="checkpoint-inline-form" onSubmit={handleCreateGroup}>
            <input
              type="text"
              value={newGroupName}
              placeholder="Nuevo grupo"
              onChange={(event) => setNewGroupName(event.target.value)}
            />
            <button type="submit">Crear</button>
          </form>
          {selectedGroupId && (
            <button type="button" className="checkpoint-danger" onClick={() => onDeleteGroup(selectedGroupId)}>
              Borrar grupo
            </button>
          )}
        </div>

        <div className="checkpoint-midi">
          <form
            key={`${midiControls.nextCc}:${midiControls.prevCc}`}
            className="checkpoint-midi-form"
            onSubmit={handleMidiSubmit}
          >
            <label>
              CC Next
              <input
                name="nextCc"
                type="number"
                min="0"
                max="127"
                defaultValue={midiControls.nextCc}
              />
            </label>
            <label>
              CC Prev
              <input
                name="prevCc"
                type="number"
                min="0"
                max="127"
                defaultValue={midiControls.prevCc}
              />
            </label>
            <button type="submit">Guardar CC</button>
          </form>
          <button type="button" className="checkpoint-midi-button" onClick={activateMidi}>
            Activar MIDI
          </button>
          <p className={`midi-state is-${midiState.type}`}>{midiState.message}</p>
        </div>
      </div>

      <form className="checkpoint-add-form" onSubmit={handleAddCheckpoint}>
        <input
          type="text"
          value={newCheckpointLabel}
          placeholder="Nombre del checkpoint"
          onChange={(event) => setNewCheckpointLabel(event.target.value)}
        />
        <button type="submit">Agregar en posición actual</button>
      </form>

      <div className="checkpoint-list">
        {activeCheckpoints.length ? (
          activeCheckpoints.map((checkpoint) => (
            <div
              key={checkpoint.id}
              className={`checkpoint-item ${activeCheckpoint?.id === checkpoint.id ? 'is-active' : ''}`}
            >
              <button type="button" onClick={() => onSeekCheckpoint(checkpoint)}>
                <span>{checkpoint.label}</span>
                <small>{formatSeconds(checkpoint.time)}</small>
              </button>
              <input
                type="text"
                defaultValue={checkpoint.label}
                aria-label={`Nombre de ${checkpoint.label}`}
                onBlur={(event) => {
                  const label = event.target.value.trim()
                  if (label && label !== checkpoint.label) onUpdateCheckpoint(checkpoint.id, { label })
                }}
              />
              <input
                type="number"
                min="0"
                step="0.1"
                defaultValue={Number(checkpoint.time).toFixed(1)}
                aria-label={`Tiempo de ${checkpoint.label}`}
                onBlur={(event) => {
                  const time = Number(event.target.value)
                  if (Number.isFinite(time) && time >= 0 && time !== checkpoint.time) {
                    onUpdateCheckpoint(checkpoint.id, { time })
                  }
                }}
              />
              <button type="button" className="checkpoint-danger" onClick={() => onDeleteCheckpoint(checkpoint.id)}>
                Borrar
              </button>
            </div>
          ))
        ) : (
          <p className="checkpoint-empty">Crea un grupo y agrega checkpoints desde la posición actual.</p>
        )}
      </div>
    </section>
  )
}
