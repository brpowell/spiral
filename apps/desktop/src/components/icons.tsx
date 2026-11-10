import {
  ArrowLeft,
  ArrowLeftRight,
  ArrowUpDown,
  AudioWaveform,
  BoomBox,
  Braces,
  CalendarPlus,
  CassetteTape,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronsLeftRightEllipsis,
  CircleQuestionMark,
  Clock,
  Columns3,
  Compass,
  Copy,
  Crop,
  Disc,
  Disc3,
  DiscAlbum,
  Download,
  Eject,
  Ellipsis,
  ExternalLink,
  EyeOff,
  FileMusic,
  FileQuestionMark,
  FolderCog,
  FolderOpen,
  FolderPen,
  FolderSymlink,
  Glasses,
  GlobeX,
  GripVertical,
  HardDrive,
  IdCard,
  Image,
  Import,
  Info,
  Link,
  List,
  ListEnd,
  ListFilter,
  ListIndentDecrease,
  ListMusic,
  ListPlus,
  ListX,
  Maximize,
  MessagesSquare,
  MicVocal,
  Minimize,
  Music,
  OctagonAlert,
  OctagonX,
  Package,
  PackagePlus,
  Palette,
  Pencil,
  Pin,
  Plus,
  RefreshCw,
  Repeat,
  Repeat1,
  Replace,
  RotateCcw,
  RotateCcwClock,
  Search,
  Settings,
  Shuffle,
  SquareArrowOutUpRight,
  Star,
  Trash2,
  TriangleAlert,
  Unlink,
  Upload,
  UserRound,
  Volume2,
  VolumeX,
  X,
  Tags,
} from "lucide-react";
import type { LucideProps } from "lucide-react";
import type { ComponentType, SVGProps } from "react";

/**
 * Spiral's icon set. Almost everything is a thin alias over a
 * [Lucide](https://lucide.dev) icon (ISC; credited in About -> Licenses via the
 * generated NOTICE). Import by the `Icon*` name here so swapping the glyph
 * behind a name is a one-line change. The brandmark and the window-caption
 * glyphs are custom and live at the bottom.
 */
type IconProps = SVGProps<SVGSVGElement>;

type LucideIcon = ComponentType<LucideProps>;

/** A Lucide icon drawn solid, for transport controls and the filled star. */
function solid(Icon: LucideIcon): LucideIcon {
  function Solid(props: LucideProps) {
    return <Icon fill="currentColor" {...props} />;
  }
  return Solid;
}

export const IconShuffle = Shuffle;
export const IconSetList = List;
export const IconColumns = Columns3;
export const IconHide = EyeOff;
export const IconRepeat = Repeat;
export const IconRepeatOne = Repeat1;
export const IconVolume = Volume2;
export const IconVolumeMute = VolumeX;
export const IconDisc2 = Disc3;
export const IconCassette = CassetteTape;
export const IconBack = ArrowLeft;
export const IconSearch = Search;
export const IconTracks = Music;
export const IconImage = Image;
export const IconAlbums = DiscAlbum;
export const IconArtists = UserRound;
export const IconGenres = Tags;
export const IconDisc = Disc;
export const IconEject = Eject;
export const IconPlaylists = ListMusic;
export const IconPlaylistAdd = ListPlus;
export const IconRemoveFromPlaylist = ListX;
export const IconPencil = Pencil;
export const IconBraces = Braces;
export const IconInfo = Info;
export const IconStar = solid(Star);
export const IconReplace = Replace;
export const IconImport = Import;
export const IconExport = Upload;
export const IconFolderCog = FolderCog;
export const IconFolderPen = FolderPen;
export const IconOpenFolder = FolderOpen;
export const IconFolderLink = FolderSymlink;
export const IconUnlink = Unlink;
export const IconRefresh = RefreshCw;
export const IconPackage = Package;
export const IconPackagePlus = PackagePlus;
export const IconPalette = Palette;
export const IconIdCard = IdCard;
export const IconChevronLeft = ChevronLeft;
export const IconChevronRight = ChevronRight;
export const IconChevronDown = ChevronDown;
export const IconCheck = Check;
export const IconCopy = Copy;
export const IconConvert = ArrowLeftRight;
export const IconReset = RotateCcw;
export const IconClose = X;
export const IconMore = Ellipsis;
export const IconHelp = CircleQuestionMark;
export const IconWarning = TriangleAlert;
export const IconMissingFile = FileQuestionMark;
export const IconAddToQueue = ListEnd;
export const IconRemoveFromQueue = ListIndentDecrease;
export const IconDelete = Trash2;
export const IconGrip = GripVertical;
export const IconPopOut = SquareArrowOutUpRight;
export const IconBoombox = BoomBox;
export const IconMaximize = Maximize;
export const IconMinimize = Minimize;
export const IconAlwaysOnTop = Pin;
export const IconClock = Clock;
export const IconMicrophone = MicVocal;
export const IconCancel = OctagonX;
export const IconFileMusic = FileMusic;
export const IconBitrate = ChevronsLeftRightEllipsis;
export const IconAudioWaveform = AudioWaveform;
export const IconVisualizer = IconAudioWaveform;
export const IconHardDrive = HardDrive;
export const IconCalendarPlus = CalendarPlus;
export const IconGlasses = Glasses;
export const IconLink = Link;
export const IconExternalLink = ExternalLink;
export const IconDownload = Download;
export const IconCrop = Crop;
export const IconArrowUpDown = ArrowUpDown;
export const IconListFilter = ListFilter;
export const IconListX = ListX;
export const IconErrorAlert = OctagonAlert;
export const IconUndoClock = RotateCcwClock;
export const IconDisconnected = GlobeX;
export const IconPlus = Plus;
export const IconSettings = Settings;
export const IconMessagesSquare = MessagesSquare;
export const IconStarOutline = Star;
export const IconCompass = Compass;

// Custom glyphs (no Lucide equivalent).

/** The Spiral brandmark glyph (brand kit `glyph-currentcolor`), filled with the text colour. */
export function IconBrandmark(props: IconProps) {
  return (
    <svg viewBox="-2 -2 380 681.5" fill="currentColor" {...props}>
      <g transform="translate(188 338.75) translate(-510 -501.75)">
        <path
          fillRule="evenodd"
          d="M353.53 433.66C349.59 435.56 347.03 439.54 343.82 442.46C327.74 457.1 319.55 474.83 322.92 496.98C323.61 501.51 325.65 505.87 327.09 510.19C336.24 537.74 364.43 563.34 388.74 577.75C397.3 582.82 406.86 587.76 416.66 589.97C435.13 594.13 452.74 594.31 470.31 586.74C472.71 585.7 475.03 584.89 477.18 583.32C495.49 569.94 503.88 550.69 501.02 527.94C499.96 519.56 496.21 512.14 492.67 504.64C489.83 498.64 486.85 490.3 481.79 485.99C479.31 482.03 476.83 478.07 474.35 474.11C471.38 469.13 468.4 464.15 465.42 459.16C464.29 457.31 463.15 455.45 462.02 453.59C459.02 444.61 454.86 436.72 454.79 426.9C454.6 401.11 478.72 379.14 496.66 363.39C499.14 361.21 502 359.37 504.38 357.09C525.4 337.01 548 318.36 569.98 299.25C589.76 282.05 608.96 263.89 629.02 246.99C643.7 234.62 657.74 221.38 671.91 208.54C676.9 204.02 685.9 198.71 687.97 191.98C691.11 181.8 684.04 174.99 676.96 168.86C663.71 157.39 655.89 165.21 645.29 174.44C634.26 184.05 623.35 193.67 612.45 203.33C606.03 209.01 599.92 215.25 593.21 220.58C577.91 232.75 563.86 246.75 549.14 259.69C517.49 287.51 486.41 316.16 454.62 343.77C430.91 364.36 407.72 385.43 384.19 406.17C374.71 414.53 361.59 424.22 353.53 433.66Z M549.91 514.7C551.37 516.46 552.83 518.22 554.29 519.97C556.21 524.54 560.31 528.32 563.02 532.52C571.49 545.67 580.98 559.17 580.81 575.59C580.55 600.26 562.46 619.21 546.19 635.52C511.54 670.27 474.81 703.25 438.62 736.47C422.98 750.83 407.43 765.03 391.87 779.49C383.97 786.85 375.54 793.77 367.92 801.37C360.46 808.8 347.33 816.63 354.41 828.99C355.43 830.76 357.4 832.5 358.96 833.82C364.83 838.74 371.29 842.93 379.21 839.86C385.89 837.27 394.48 827.3 400.23 822.45C414.73 810.21 429.09 797.65 443.2 785.02C499.34 734.72 557 686.22 613.63 636.55C631.09 621.23 648.38 605.85 665.96 590.67C672.16 585.32 684.08 575.94 687.37 568.64C688.05 567.71 688.74 566.79 689.43 565.87C691.48 563.86 692.04 561.58 693.31 559.05C701.87 542.01 698.29 523.3 692.43 506.03C689.41 497.1 684.37 489.39 679.55 481.42C660.19 449.41 618.74 415.18 580.27 412.1C572.77 411.5 564.84 411.81 557.59 413.91C548.84 416.44 540.25 420 533.75 426.66C511.92 449.03 524.49 479.8 539.99 501.32C543.22 505.8 545.73 511.03 549.91 514.7Z"
        />
      </g>
    </svg>
  );
}

/** Caption-bar minimize (horizontal rule). */
export function IconWindowMinimize(props: IconProps) {
  return (
    <svg viewBox="0 0 12 12" fill="currentColor" aria-hidden {...props}>
      <rect x="2" y="5.25" width="8" height="1.5" rx="0.5" />
    </svg>
  );
}

/** Caption-bar maximize (single square). */
export function IconWindowMaximize(props: IconProps) {
  return (
    <svg
      viewBox="0 0 12 12"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.25"
      aria-hidden
      {...props}
    >
      <rect x="2.25" y="2.25" width="7.5" height="7.5" rx="0.5" />
    </svg>
  );
}

/** Caption-bar restore (overlapping squares). */
export function IconWindowRestore(props: IconProps) {
  return (
    <svg
      viewBox="0 0 12 12"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.25"
      aria-hidden
      {...props}
    >
      <path d="M3.5 4.25h4.25V8.5H3.5z" />
      <path d="M4.75 3.5h4.25v4.25" />
    </svg>
  );
}

/** Solid transport glyphs, kept from the original set (Lucide's outlines read too light on the transport buttons). */
export function IconPlay(props: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinejoin="round"
      aria-hidden
      {...props}
    >
      <path d="M8 5v14l11-7L8 5z" />
    </svg>
  );
}

export function IconPause(props: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinejoin="round"
      aria-hidden
      {...props}
    >
      <rect x="6.75" y="6" width="2.5" height="12" />
      <rect x="14.75" y="6" width="2.5" height="12" />
    </svg>
  );
}

export function IconPrevious(props: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      {...props}
    >
      <path d="M6 6v12" />
      <path d="M10.5 12 18 18V6z" />
    </svg>
  );
}

export function IconNext(props: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      {...props}
    >
      <path d="M18 6v12" />
      <path d="M13.5 12 6 18V6z" />
    </svg>
  );
}
