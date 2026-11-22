export default function ProgressBar({ value, label, color }) {
  return (
    <div className="progress">
      <div className="progress__row">
        <span>{label}</span>
        <strong>{value}%</strong>
      </div>
      <div
        className="progress__track"
        role="progressbar"
        aria-label="Progress toward word goal"
        aria-valuenow={value}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div className="progress__fill" style={{ width: `${value}%`, background: color }} />
      </div>
    </div>
  );
}
