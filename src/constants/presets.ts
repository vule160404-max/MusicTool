import type { PresetChart } from '../types';

export const DEFAULT_PRESET_CHARTS: PresetChart[] = [
  {
    id: 'vpop-all-combined',
    label: '🔥 Toàn Tập V-Pop (Tổng hợp)',
    region: 'Việt Nam',
    spotifyUrl: [
      'https://open.spotify.com/playlist/37i9dQZF1DX4g8Gs5nUhpp',
      'https://open.spotify.com/playlist/37i9dQZF1DX0F4i7Q9pshJ',
      'https://open.spotify.com/playlist/37i9dQZEVXbLdGSmz6xilI',
    ].join('\n'),
    description: 'Toàn bộ danh sách V-Pop lớn nhất từ các bảng xếp hạng Spotify (đã loại bỏ trùng lặp).',
  },
  {
    id: '37i9dQZEVXbLdGSmz6xilI',
    label: 'Top 50 - Việt Nam',
    region: 'Việt Nam',
    spotifyUrl: 'https://open.spotify.com/playlist/37i9dQZEVXbLdGSmz6xilI',
    description: 'Bảng xếp hạng 50 ca khúc được nghe nhiều nhất tại Việt Nam hôm nay.',
  },
  {
    id: '37i9dQZF1DX0F4i7Q9pshJ',
    label: 'Hot Hits Vietnam',
    region: 'Việt Nam',
    spotifyUrl: 'https://open.spotify.com/playlist/37i9dQZF1DX0F4i7Q9pshJ',
    description: 'Tuyển tập các bản hit thịnh hành và bùng nổ trên bảng xếp hạng Việt.',
  },
  {
    id: '37i9dQZF1DX4g8Gs5nUhpp',
    label: 'V-Pop Không Thể Thiếu',
    region: 'Việt Nam',
    spotifyUrl: 'https://open.spotify.com/playlist/37i9dQZF1DX4g8Gs5nUhpp',
    description: 'Những ca khúc V-Pop nổi bật và được yêu thích hàng đầu.',
  },
  {
    id: '37i9dQZEVXbMDoHDwVN2tF',
    label: 'Top 50 - Toàn Cầu',
    region: 'Global',
    spotifyUrl: 'https://open.spotify.com/playlist/37i9dQZEVXbMDoHDwVN2tF',
    description: '50 bản nhạc thịnh hành nhất toàn thế giới trên Spotify.',
  },
  {
    id: '37i9dQZF1DXcBWIGoYBM5M',
    label: "Today's Top Hits",
    region: 'Global',
    spotifyUrl: 'https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M',
    description: 'Playlist nhạc quốc tế hot nhất được cập nhật liên tục.',
  },
  {
    id: '37i9dQZF1DX9tPFwDMOaN1',
    label: 'K-Pop ON! (온)',
    region: 'Hàn Quốc',
    spotifyUrl: 'https://open.spotify.com/playlist/37i9dQZF1DX9tPFwDMOaN1',
    description: 'Top ca khúc K-Pop mới nhất và thịnh hành nhất.',
  },
  {
    id: '37i9dQZEVXbLRQDuF5jeBp',
    label: 'Top 50 - USA',
    region: 'Hoa Kỳ',
    spotifyUrl: 'https://open.spotify.com/playlist/37i9dQZEVXbLRQDuF5jeBp',
    description: '50 ca khúc dẫn đầu bảng xếp hạng tại thị trường Mỹ.',
  },
];
