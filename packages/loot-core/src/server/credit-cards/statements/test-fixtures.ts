import type { StatementLine, StatementText } from './types';

type Cell = [x: number, text: string];

export function line(...cells: Cell[]): StatementLine {
  return { cells: cells.map(([x, text]) => ({ x, text })) };
}

type RennerFixture = {
  dueDate?: string;
  closingDate?: string;
  total?: string;
  minimum?: string;
  entries: StatementLine[];
};

/** A Renner (Realize) statement laid out like the bank's PDF. */
export function rennerStatement({
  dueDate = '13/10/2026',
  closingDate = '28/09/2026',
  total = '1.912,25',
  minimum = 'R$ 1.567,19',
  entries,
}: RennerFixture): StatementText {
  return {
    pages: [
      [
        line([10, 'Número do Cartão Principal do Titular']),
        line([10, '5443.****.****.1234']),
        line([10, 'Olá'], [23, 'MARIA'], [68, '!']),
        line(
          [72, 'Pagamento Total'],
          [260, 'Data de Vencimento'],
          [467, 'Limite Total'],
        ),
        line([84, total], [275, dueDate], [475, '10.000,00']),
        line(
          [83, 'Mínimo¹'],
          [206, 'Parcelamento'],
          [338, 'Parcelamento'],
          [469, 'Parcelamento³'],
        ),
        line([202, '5x de R$ 536,87'], [333, '6x de R$ 483,49']),
        line([77, minimum]),
        line([
          48,
          'Beneficiário: Realize Sociedade de Crédito, Financiamento e Investimento S.A.',
        ]),
        line(
          [46, 'Data Documento'],
          [103, 'Número Documento'],
          [304, 'Data do Processamento'],
        ),
        line([56, closingDate], [129, '1264118122'], [324, closingDate]),
        line([15, 'Resumo da sua fatura:']),
        line([14, 'Lançamentos detalhados do período:']),
        line(
          [25, 'Data'],
          [131, 'Descrição'],
          [330, 'Estabelecimento'],
          [518, 'Crédito/'],
        ),
        line([520, 'Débito']),
        line([62, 'TRANSAÇÕES REALIZADAS PELO']),
        line([62, 'TITULAR:']),
        line([62, 'MARIA DA SILVA']),
        ...entries,
        line([14, 'Compras parceladas - Próximas Faturas']),
        line([17, '30/01/2026'], [67, 'LOJA X Parc. 9/10'], [530, '400,00']),
      ],
      [
        line([23, 'Limites em R$'], [319, 'Composição do Pagamento Mínimo']),
        line([129, 'Total'], [185, 'Utilizado'], [241, 'Disponível']),
        line(
          [18, 'Compras'],
          [112, '10.000,00'],
          [182, '2.712,25'],
          [243, '7.287,75'],
        ),
      ],
    ],
  };
}

type RiachueloFixture = {
  dueDate?: string;
  closingDate?: string;
  total?: string;
  entries: StatementLine[];
};

/** A Riachuelo (Midway) statement laid out like the bank's PDF. */
export function riachueloStatement({
  dueDate = '13/10/2026',
  closingDate = '06/10/2026',
  total = '1.320,64',
  entries,
}: RiachueloFixture): StatementText {
  return {
    pages: [
      [
        line([295, 'Melhor data']),
        line(
          [62, 'Vencimento'],
          [164, 'Saldo à Pagar (R$)'],
          [389, 'Fatura mensal'],
        ),
        line([298, 'de compra']),
        line([390, 'Titular:'], [419, 'MARIA D SILVA']),
        line([52, dueDate], [172, total], [283, '07/10/2026']),
        line([390, 'Cartão:'], [419, '5365.XXXX.XXXX.9876']),
        line([43, 'Saldo Anterior'], [338, '1.320,64']),
        line(
          [43, 'Pagamentos/Créditos'],
          [333, '- 1.320,64'],
          [437, 'Total'],
          [473, '13.420,00'],
        ),
        line(
          [43, 'Saldo desta Fatura'],
          [335, total],
          [428, 'Disponivel'],
          [487, '8.662,80'],
        ),
        line([408, `Limite disponível para compras em ${closingDate}.`]),
        line([43, 'Total'], [259, '879,78'], [335, '3.583,08']),
        line([250, 'Histórico de Despesas']),
        line(
          [266, 'Valor'],
          [311, 'Juros'],
          [377, 'Ult. venc.'],
          [472, 'Nº'],
          [503, 'Lançamento'],
        ),
        line(
          [43, 'Data'],
          [72, 'Loja Descrição'],
          [347, 'IOF'],
          [427, 'Valor'],
        ),
        line(
          [266, 'original'],
          [311, 's/ IOF'],
          [377, 'parcela'],
          [472, 'parc.'],
          [524, 'do mês'],
        ),
        ...entries,
        line([
          43,
          'Continue acumulando 12% de cashback com o Cartão Riachuelo',
        ]),
        line([278, 'Encargos']),
      ],
      [line([43, 'ENDEREÇO MIDWAY: R. EXEMPLO, 1, SP'])],
    ],
  };
}
