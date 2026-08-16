import type { JavInfoSource } from './loadInfo'
import { Fd2Ppv, isFd2PpvAvNumber } from './fd2Ppv'
import { JavBus } from './javBus'
import { JavDB } from './javDB'
import { JavLibrary } from './javLibrary'
import { MissAV } from './missAV'

/** 为当前标识创建范围最窄的资料源列表。 */
export function createJavInfoSources(avNumber: string): JavInfoSource[] {
  const sources: JavInfoSource[] = [
    new JavLibrary(),
    new JavBus(),
    new JavDB(),
    new MissAV(),
  ]
  return isFd2PpvAvNumber(avNumber) ? [new Fd2Ppv(), ...sources] : sources
}
