/* eslint-disable jsdoc/convert-to-jsdoc-comments */
import { Logger } from '@115master/shared'
import { describe, expect, it } from 'vitest'
import {
  buildEd2kLink,
  ED2K_EMPTY_HASH,
  ED2K_PART_SIZE,
  finishEd2kHash,
  hashEd2kPart,
} from '../index'

const logger = new Logger('ED2KHashTest')

describe('ed2k hash', () => {
  /**
   * ============================================================================
   * 步骤1：验证单分块 MD4
   * ============================================================================
   * 目标：用 RFC 1320 的 abc 向量验证底层 MD4。
   * 数据源：UTF-8 字节 abc。
   * 操作：
   * 1) 计算分块摘要
   * 2) 生成带 Unicode 文件名的标准链接
   */
  it('uses the direct MD4 digest for a file smaller than one ED2K part', async () => {
    logger.info('开始验证 ED2K 单分块向量')

    // 1.1 RFC 1320 已知向量必须保持大写输出
    const hash = await hashEd2kPart(new TextEncoder().encode('abc'))
    expect(hash).toBe('A448017AAF21D8525FC10AE87AA6729D')
    expect(await finishEd2kHash([hash], 3)).toBe(hash)

    // 1.2 文件名只替换协议分隔符，保留多语言字符和空格
    expect(buildEd2kLink('藤田 ゆず|片.mp4', 3, hash)).toBe(
      'ed2k://|file|藤田 ゆず_片.mp4|3|A448017AAF21D8525FC10AE87AA6729D|/',
    )
    logger.info('ED2K 单分块向量验证完成')
  })

  /**
   * ============================================================================
   * 步骤2：验证整分块兼容规则
   * ============================================================================
   * 目标：确认整 9,728,000 字节文件追加 MD4 空分块摘要。
   * 数据源：独立 OpenSSL MD4 生成的全零分块参考向量。
   * 操作：
   * 1) 计算完整数据分块摘要
   * 2) 汇总并比对最终摘要
   */
  it('adds the protocol empty-part hash at an exact part boundary', async () => {
    logger.info('开始验证 ED2K 整分块向量')

    // 2.1 全零标准分块摘要由独立 OpenSSL MD4 参考实现生成
    const part = await hashEd2kPart(new Uint8Array(ED2K_PART_SIZE))
    expect(part).toBe('D7DEF262A127CD79096A108E7A9FC138')
    expect(ED2K_EMPTY_HASH).toBe('31D6CFE0D16AE931B73C59D7E0C089C0')

    // 2.2 最终摘要必须覆盖数据分块和协议空分块
    await expect(finishEd2kHash([part], ED2K_PART_SIZE))
      .resolves
      .toBe('FC21D9AF828F92A8DF64BEAC3357425D')
    logger.info('ED2K 整分块向量验证完成')
  })

  /**
   * ============================================================================
   * 步骤3：验证非整分块汇总
   * ============================================================================
   * 目标：确认尾部有数据时不追加空分块摘要。
   * 数据源：全零标准分块加一个零字节的 OpenSSL 参考向量。
   * 操作：
   * 1) 计算尾部分块摘要
   * 2) 汇总两个真实数据分块
   */
  it('hashes only real data parts when the final part is non-empty', async () => {
    logger.info('开始验证 ED2K 非整分块向量')

    // 3.1 使用已知的标准分块和单字节摘要
    const parts = [
      'D7DEF262A127CD79096A108E7A9FC138',
      await hashEd2kPart(new Uint8Array(1)),
    ]
    expect(parts[1]).toBe('47C61A0FA8738BA77308A8A600F88E4B')

    // 3.2 最终摘要只覆盖两个真实数据分块
    await expect(finishEd2kHash(parts, ED2K_PART_SIZE + 1))
      .resolves
      .toBe('06329E9DBA1373512C06386FE29E3C65')
    logger.info('ED2K 非整分块向量验证完成')
  })
})
