import { Share } from '@115master/drive115'
import { MASTER_BASE_URL } from '.'

const ROUTE_MATCH = {
  JAVLIBRARY_WORKER: 'https://www.javlibrary.com/cn/',
  MASTER: `${MASTER_BASE_URL}*`,
  MAGNET: `${MASTER_BASE_URL}/magnet/*`,
  HOME: `*://${Share.CONSTANT.HOST_115.NORMAL}/?*`,
  OFFICIAL: `*://${Share.CONSTANT.HOST_115.NORMAL}/*`,
  VIDEO_TOKEN: `*://${Share.CONSTANT.HOST_115.DL}/video/token`,
}

export default ROUTE_MATCH
