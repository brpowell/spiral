import { useMemo, useRef } from "react";
import { useTranslation } from "react-i18next";
import { DiscographyTimeline } from "@/components/DiscographyTimeline/DiscographyTimeline";
import { EntityArt } from "@/components/EntityArt/EntityArt";
import { Button } from "@/components/common/Button/Button";
import { Field, FieldLabel } from "@/components/common/Field/Field";
import { Switch } from "@/components/common/Switch/Switch";
import { AddToPlaylistSubmenu } from "@/components/AddToPlaylistSubmenu/AddToPlaylistSubmenu";
import {
  ContextMenuItem,
  ContextMenuSeparator,
} from "@/components/ContextMenu/ContextMenu";
import { MenuButton } from "@/components/MenuButton/MenuButton";
import {
  IconAddToQueue,
  IconArtists,
  IconBack,
  IconConvert,
  IconDelete,
  IconPencil,
  IconPlay,
} from "@/components/icons";
import {
  albumsForArtist,
  type ArtistBrowseMode,
  artistTotalDurationSeconds,
  getArtistByKey,
} from "@/lib/artists/artists";
import { openConvertForTrackIds } from "@/lib/files/convertTracks";
import { isTrackConvertible } from "@/lib/import/pendingImportTrack";
import { formatDurationNatural } from "@/lib/format/format";
import { useRemoveTracksDialog } from "@/hooks/useRemoveTracksDialog";
import { useDetailReturnLabel } from "@/hooks/useDetailReturnLabel";
import { useNavigationStore } from "@/store/useNavigationStore";
import { usePlayerStore } from "@/store/usePlayerStore";
import type { Album } from "@/types/album";
import type { Artist } from "@/types/artist";
import "./ArtistDetailView.css";
import "./DetailViewShared.css";

interface ArtistDetailViewProps {
  albums: Album[];
  artists: Artist[];
  performerArtists: Artist[];
  artistKey: string;
  browseMode: ArtistBrowseMode;
}

export function ArtistDetailView({
  albums,
  artists,
  performerArtists,
  artistKey,
  browseMode,
}: ArtistDetailViewProps) {
  const { t } = useTranslation("library");
  const closeArtist = useNavigationStore((s) => s.closeArtist);
  const artistReturnContext = useNavigationStore((s) => s.artistReturnContext);
  const setArtistBrowseMode = useNavigationStore((s) => s.setArtistBrowseMode);
  const playlistSubmenuRef = useRef<HTMLDivElement>(null);
  const playTracks = usePlayerStore((s) => s.playTracks);
  const addToQueue = usePlayerStore((s) => s.addToQueue);
  const openArtistEditor = usePlayerStore((s) => s.openArtistEditor);

  const browseArtist = getArtistByKey(artists, artistKey);
  const artist = browseArtist ?? getArtistByKey(performerArtists, artistKey);
  const editorBrowseMode = browseArtist != null ? browseMode : "performers";
  const albumArtistsOnly = browseMode === "discography";
  const { openRemoveDialog, removeDialog } = useRemoveTracksDialog(
    artist?.tracks ?? [],
    closeArtist,
  );
  const backLabel = useDetailReturnLabel(artistReturnContext, artists);
  const discography = useMemo(
    () => (artist ? albumsForArtist(albums, artist, browseMode) : []),
    [albums, artist, browseMode],
  );

  if (!artist) {
    return (
      <div className="artist-detail artist-detail--missing">
        <Button
          variant="ghost"
          size="sm"
          className="artist-detail__back"
          onClick={closeArtist}
        >
          <IconBack />
          {backLabel}
        </Button>
        <p>{t("views.artists.notFound")}</p>
      </div>
    );
  }

  const trackIds = artist.tracks.map((t) => t.id);
  const convertibleCount = artist.tracks.filter((track) =>
    isTrackConvertible(track),
  ).length;
  const totalDuration = artistTotalDurationSeconds(artist.tracks);
  const discographySectionTitle = albumArtistsOnly
    ? t("views.artists.discography")
    : t("views.artists.appearsOn");
  const emptyDiscographyMessage = albumArtistsOnly
    ? t("views.artists.emptyDiscography")
    : t("views.artists.emptyPerformer");

  const handlePlayAll = () => {
    const first = artist.tracks[0];
    if (first) void playTracks(trackIds, first.id);
  };

  const handleAddToQueue = () => {
    addToQueue(trackIds);
  };

  return (
    <div className="artist-detail">
      {removeDialog}
      <div className="artist-detail__toolbar">
        <Button
          variant="ghost"
          size="sm"
          className="artist-detail__back"
          onClick={closeArtist}
        >
          <IconBack />
          {backLabel}
        </Button>
      </div>

      <section className="artist-detail__hero">
        <EntityArt
          artPath={artist.artPath}
          alt={artist.name}
          className="album-art--hero album-art--round artist-detail__art"
          placeholder={<IconArtists />}
        />
        <div className="artist-detail__meta">
          <h1 className="artist-detail__title">{artist.name}</h1>
          <p className="artist-detail__stats">
            {[
              t("counts.albums", { count: discography.length }),
              t("counts.tracks", { count: artist.tracks.length }),
              formatDurationNatural(totalDuration),
            ]
              .filter(Boolean)
              .join(" · ")}
          </p>
          <div className="detail-view__actions">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => openArtistEditor(artist.key, editorBrowseMode)}
            >
              <IconPencil />
              {t("actions.editArtist")}
            </Button>
            <MenuButton
              triggerPlacement="below-start"
              ariaLabel={t("views.artists.actionsAria")}
              layoutDeps={[artist.tracks.length, convertibleCount]}
              size="sm"
              variant="secondary"
              dismissExcludeRefs={[playlistSubmenuRef]}
            >
              {(close) => (
                <>
                  <ContextMenuItem
                    icon={<IconPlay />}
                    label={t("actions.playAll")}
                    disabled={artist.tracks.length === 0}
                    onClick={() => {
                      close();
                      handlePlayAll();
                    }}
                  />
                  {artist.tracks.length > 0 ? (
                    <ContextMenuItem
                      icon={<IconAddToQueue />}
                      label={t("actions.addToQueue")}
                      onClick={() => {
                        close();
                        handleAddToQueue();
                      }}
                    />
                  ) : null}
                  {artist.tracks.length > 0 ? <ContextMenuSeparator /> : null}
                  {artist.tracks.length > 0 ? (
                    <AddToPlaylistSubmenu
                      trackIds={trackIds}
                      closeMenu={close}
                      panelRef={playlistSubmenuRef}
                    />
                  ) : null}
                  {convertibleCount > 0 ? (
                    <ContextMenuItem
                      icon={<IconConvert />}
                      label={t("actions.convert", { count: convertibleCount })}
                      onClick={() => {
                        close();
                        openConvertForTrackIds(trackIds);
                      }}
                    />
                  ) : null}
                  {artist.tracks.length > 0 ? <ContextMenuSeparator /> : null}
                  {artist.tracks.length > 0 ? (
                    <ContextMenuItem
                      icon={<IconDelete />}
                      label={t("actions.removeFromLibrary", {
                        count: artist.tracks.length,
                      })}
                      className="context-menu__danger"
                      onClick={() => {
                        close();
                        openRemoveDialog();
                      }}
                    />
                  ) : null}
                </>
              )}
            </MenuButton>
          </div>
        </div>
      </section>

      <section className="artist-detail__discography">
        <div className="artist-detail__discography-header">
          <h2 className="artist-detail__section-title">
            {discographySectionTitle}
          </h2>
          <Field orientation="horizontal" className="artist-detail__filter">
            <FieldLabel htmlFor="artist-detail-album-only">
              {t("views.artists.albumArtistOnly")}
            </FieldLabel>
            <Switch
              id="artist-detail-album-only"
              checked={albumArtistsOnly}
              onChange={(e) =>
                setArtistBrowseMode(
                  e.target.checked ? "discography" : "performers",
                )
              }
            />
          </Field>
        </div>
        {discography.length > 0 ? (
          <DiscographyTimeline
            albums={discography}
            artist={artist}
            mode={browseMode}
          />
        ) : (
          <p className="artist-detail__empty-discography">
            {emptyDiscographyMessage}
          </p>
        )}
      </section>
    </div>
  );
}
