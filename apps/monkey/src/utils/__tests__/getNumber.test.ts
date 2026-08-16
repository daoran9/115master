import { describe, expect, it } from 'vitest'
import { getAvNumber } from '@/utils/getNumber'

describe('getNumber', () => {
  it('fC2系列', () => {
    expect(getAvNumber('FC2-PPV-123456')).toBe('FC2-PPV-123456')
    expect(getAvNumber('fc2ppv-123456')).toBe('FC2-PPV-123456')
    expect(getAvNumber('[FC2-PPV-123456]')).toBe('FC2-PPV-123456')
    expect(getAvNumber('FC2PPV-123456')).toBe('FC2-PPV-123456')
    expect(getAvNumber('489155.com@FC2PPV- 4818259-C.mp4')).toBe('FC2-PPV-4818259')
    expect(getAvNumber('hhd800.com@FC2-PPV-4853836.restored.mp4')).toBe('FC2-PPV-4853836')
    expect(getAvNumber('489155.com@FC2PPV-4911543-1.mp4')).toBe('FC2-PPV-4911543')
  })

  it('hEYZO系列', () => {
    expect(getAvNumber('HEYZO-1234')).toBe('HEYZO-1234')
    expect(getAvNumber('heyzo 1234')).toBe('HEYZO-1234')
    expect(getAvNumber('[HEYZO-1234]')).toBe('HEYZO-1234')
  })

  // 麻豆系列测试
  it('麻豆系列', () => {
    expect(getAvNumber('MDX-0123')).toBe('MDX-0123')
    expect(getAvNumber('MKY-NS-001')).toBe('MKY-NS-001')
    expect(getAvNumber('MD-0123')).toBe('MD-0123')
    expect(getAvNumber('MDHR-001')).toBe('MDHR-001')
    expect(getAvNumber('MDVR-153')).toBe('MDVR-153')
    expect(getAvNumber('ABMD-123')).toBe('ABMD-123')
    expect(getAvNumber('MDTM-001')).toBe('MDTM-001')
  })

  it('加勒比系列', () => {
    expect(getAvNumber('Carib-123-456')).toBe('CARIB-123-456')
    expect(getAvNumber('Caribbean-123-456')).toBe('CARIB-123-456')
    expect(getAvNumber('carib 123 456')).toBe('CARIB-123-456')
  })

  it('东京热系列', () => {
    expect(getAvNumber('Tokyo-Hot-n1234')).toBe('TOKYO-HOT-N1234')
    expect(getAvNumber('tokyo hot n1234')).toBe('TOKYO-HOT-N1234')
  })

  it('一本道系列 or Pacopacomama or 10musume系列', () => {
    expect(getAvNumber('042906_872')).toBe('042906_872')
    expect(getAvNumber('10musume-123114_01')).toBe('123114_01')
    expect(getAvNumber('10musume 123114 01')).toBe('123114_01')
    expect(getAvNumber('pacopacomama-123114_01')).toBe('123114_01')
    expect(getAvNumber('Pacopacomama 123114 01')).toBe('123114_01')
    expect(getAvNumber('1pondo-010123_001.mp4')).toBe('010123_001')
    expect(getAvNumber('10musume-133114_01.mp4')).toBeNull()
  })

  it('heydouga系列', () => {
    expect(getAvNumber('heydouga-4037-123')).toBe('4037-123')
    expect(getAvNumber('Heydouga 4037-123')).toBe('4037-123')
    expect(getAvNumber('Heydouga 4037-1234')).toBe('4037-1234')
  })

  it('标准格式', () => {
    expect(getAvNumber('GDSC-88')).toBe('GDSC-88')
    expect(getAvNumber('GMMD-02')).toBe('GMMD-02')
    expect(getAvNumber('ABC-123')).toBe('ABC-123')
    expect(getAvNumber('ABCD-12345')).toBe('ABCD-12345')
    expect(getAvNumber('abc123')).toBe('ABC-123')
    expect(getAvNumber('[ABC-123]')).toBe('ABC-123')
    expect(getAvNumber('123ABC-123')).toBe('123ABC-123')
    expect(getAvNumber('SORA-636.mp4')).toBe('SORA-636')
  })

  it('识别带连字符的长前缀番号', () => {
    expect(getAvNumber('MURIKURI-009.mp4')).toBe('MURIKURI-009')
    expect(getAvNumber('[MURIKURI-009] restored.mp4')).toBe('MURIKURI-009')
    expect(getAvNumber('MURIKURI009.mp4')).toBeNull()
  })

  it('停用 MyFans 来源后不把文件名误送到普通番号来源', () => {
    /*
     * ================================================================================
     * 步骤1：验证 MyFans 文件隔离
     * ================================================================================
     * 目标：移除 MyFans 来源后不生成内部键，也不把账号尾号当成普通番号。
     * 数据源：带品牌词和括号账号的现场文件名。
     * 操作：
     * 1) 核对显式品牌文件返回空
     * 2) 核对账号格式返回空且标准番号不受影响
     */
    console.info('[test] 开始验证 MyFans 文件隔离')

    expect(getAvNumber('www.98T.la@Myfansみなと(minato___26)【正片露脸】.mp4')).toBeNull()
    expect(getAvNumber('MyFansティアくん(tiakun_404)作品.mp4')).toBeNull()
    expect(getAvNumber('(banbi_555) 狂操爆乳骚奶子.mp4')).toBeNull()
    expect(getAvNumber('ティアくん(tiakun_404)曾担任女性杂志专属模特。^WM10.mp4')).toBeNull()
    expect(getAvNumber('五条ライ(raikun325)身材娇小苗条拥有F罩杯。restored12.mp4')).toBeNull()
    expect(getAvNumber('(ABC-123) [HD].mp4')).toBe('ABC-123')

    console.info('[test] MyFans 文件隔离验证完成')
  })

  it('保留完整前缀和数字，不从番号中间截断', () => {
    expect(getAvNumber('SORA-636ch.mp4')).toBe('SORA-636')
    expect(getAvNumber('YMDD-502.mp4')).toBe('YMDD-502')
    expect(getAvNumber('1TANF-006.mp4')).toBe('TANF-006')
    expect(getAvNumber('www.98T.la@1TANF-006.restored.mp4')).toBe('TANF-006')
    expect(getAvNumber('345SIMM-729白川ゆず_restored.mp4')).toBe('SIMM-729')
    expect(getAvNumber('390JAC-086西田カリナ_restored.mp4')).toBe('JAC-086')
    expect(getAvNumber('259LUXU-123.mp4')).toBe('259LUXU-123')
    expect(getAvNumber('www.98T.la@1YMDD-322-C.restored.mp4')).toBe('YMDD-322')
    expect(getAvNumber('1www.98T.la@1NHDTB-922.restored_iris2.mp4')).toBe('NHDTB-922')
    expect(getAvNumber('www.98T.la@390JAC-072M.restored.mp4')).toBe('JAC-072')
    expect(getAvNumber('483SGK-079-C白川ゆず_restored.mp4')).toBe('SGK-079')
    expect(
      getAvNumber('[无码破解]390JAC-072 【高身長精子好きGAL】.mp4'),
    ).toBe('JAC-072')
    expect(
      getAvNumber('【无码流出】483SGK-079 流出版.mp4'),
    ).toBe('SGK-079')
    expect(getAvNumber('ENKI-049ハメ棒300本超えちゃった性欲止まんない変態娘_restored.mp4')).toBe('ENKI-049')
    expect(
      getAvNumber('[url]www.98T.la@MUDR-278.restored.mp4[/url].mp4'),
    ).toBe('MUDR-278')
  })

  it('忽略恢复文件附带的版本和编码标记', () => {
    expect(getAvNumber('hnjc-007hhb.restored.mp4')).toBe('HNJC-007')
    expect(getAvNumber('hnd-426mp4.restored.mp4')).toBe('HND-426')
    expect(getAvNumber('avop-0328mp4.restored.mp4')).toBe('AVOP-0328')
    expect(getAvNumber('migd-533B_reencoded.restored.mp4')).toBe('MIGD-533')
    expect(getAvNumber('MIGD-335D_reencoded.restored.mp4')).toBe('MIGD-335')
    expect(getAvNumber('MIGD-.765mp4.MR.restored.mp4')).toBe('MIGD-765')
    expect(getAvNumber('a1080hd.com@migd00781hhb.MR.restored.mp4')).toBe('MIGD-781')
    expect(
      getAvNumber('【Thz.la】hnd00134hhb_2025.12.06-16.41.16.restored.mp4'),
    ).toBe('HND-134')
  })

  it('带有额外信息的文件名', () => {
    expect(getAvNumber('ABC-123 1080p')).toBe('ABC-123')
    expect(getAvNumber('ABC-123c.mp4')).toBe('ABC-123')
    expect(getAvNumber('ABC-123 [HD]')).toBe('ABC-123')
    expect(getAvNumber('ABC-123_HD.mp4')).toBe('ABC-123')
    expect(getAvNumber('【ABC-123】中文标题.mp4')).toBe('ABC-123')
    expect(getAvNumber('(ABC-123) [HD].mp4')).toBe('ABC-123')
    expect(getAvNumber('hjd2048.com-0629mide661-h264')).toBe('MIDE-661')
    expect(getAvNumber('[activehlj.com]@SONE-263_[4K]')).toBe('SONE-263')
    expect(getAvNumber('4k2.com@ipzz-469')).toBe('IPZZ-469')
    expect(getAvNumber('hhd800.com@ABW-304-C_X1080X')).toBe('ABW-304')
    expect(getAvNumber('REAL-957-U.mp4')).toBe('REAL-957')
    expect(getAvNumber('LULU-237-Uncensored.mp4')).toBe('LULU-237')
    expect(getAvNumber('BF-304RQ～美脚の誘惑！中出しレースクィーン！～椎名ゆな_restored.mp4')).toBe('BF-304')
    expect(getAvNumber('MIRD-150JとL超乳W真性中出し沖田杏梨Hitomi_restored.mp4')).toBe('MIRD-150')
    expect(getAvNumber('TMY-004ver.知名度狩リ2女優名表記不可_restored.mp4')).toBe('TMY-004')
    expect(getAvNumber('TMY-013ver.知名度狩リ4佐藤ののか_restored.mp4')).toBe('TMY-013')
    expect(getAvNumber('[无码破解]PGD\u200B\u200B-934 我的身体.mp4')).toBe('PGD-934')
    expect(getAvNumber('[无码破解]PGD\uFEFF-948 早泄姐姐.mp4')).toBe('PGD-948')
    expect(getAvNumber('[无码破解]NOSKN–078 无码流出.mp4')).toBe('NOSKN-078')
    expect(
      getAvNumber('NCYF-014堀北わんガチ8P超乱交！低身長140cm台妖精美少女レイヤー18歳_restored.mp4'),
    ).toBe('NCYF-014')
    expect(getAvNumber('140CM-18.restored.mp4')).toBe('140CM-18')
  })

  it('无效输入', () => {
    expect(getAvNumber('')).toBeNull()
    expect(getAvNumber('invalid')).toBeNull()
    expect(getAvNumber('123456')).toBeNull()
    expect(getAvNumber('abcdef')).toBeNull()
    expect(getAvNumber('abcdef12345')).toBeNull()
    expect(getAvNumber('20240101_1080p.mp4')).toBeNull()
    expect(getAvNumber('MDHR001extra.mp4')).toBeNull()
    expect(getAvNumber('www.98T.la@SyMengNan689')).toBeNull()
    expect(
      getAvNumber('www.98T.la@share_db86f06fdfbf31573ca6828ac0716d22'),
    ).toBeNull()
  })
})
