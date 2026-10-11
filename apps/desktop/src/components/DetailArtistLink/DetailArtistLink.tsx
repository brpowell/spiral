import { useNavigationStore } from "../../store/useNavigationStore";
import "./DetailArtistLink.css";

interface DetailArtistLinkProps {
  name: string;
  artistKey?: string | null;
  className?: string;
}

export function DetailArtistLink({
  name,
  artistKey,
  className,
}: DetailArtistLinkProps) {
  const openArtist = useNavigationStore((s) => s.openArtist);

  return (
    <p className={className}>
      {artistKey ? (
        <button
          type="button"
          className="detail-artist-link"
          onClick={() => openArtist(artistKey)}
        >
          {name}
        </button>
      ) : (
        name
      )}
    </p>
  );
}
