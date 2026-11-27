export function View({ items, onPick }) {
  return (
    <ul>
      {items.map((item) => (
        <li key={item.id} onClick={() => onPick(item.id)}>
          {item.label}
        </li>
      ))}
    </ul>
  );
}
