import { RadioGroupMaterial, CheckboxGroupMaterial, groupContracts } from './groups';
import { DateMaterial, TimeMaterial, temporalContracts } from './temporal';
import { RateMaterial, rateContracts } from './rate';
import { SliderMaterial, sliderContracts } from './slider';
import { ColorPickerMaterial, colorPickerContracts } from './color-picker';
import { CascaderMaterial, cascaderContracts } from './cascader';
import { UploadMaterial, uploadContracts } from './upload';
import { RichTextMaterial, RichTextDisplayMaterial, richTextContracts } from './rich-text';
import {
  LayoutMaterial,
  FormMaterial,
  CardMaterial,
  ContainerMaterial,
  DividerMaterial,
  TabsMaterial,
  TabPanelMaterial,
  containerContracts,
} from './containers';
import { FieldArrayMaterial, fieldArrayContracts } from './field-array';
import {
  ImageMaterial,
  LinkMaterial,
  DescriptionsMaterial,
  ListMaterial,
  TableMaterial,
  PaginationMaterial,
  dataContracts,
} from './data';
import {
  DialogMaterial,
  DrawerMaterial,
  AlertMaterial,
  LoadingMaterial,
  feedbackContracts,
} from './feedback';
import type { ReactMaterials } from '../../packages/react-runtime/Renderer';

export const extendedMaterials: ReactMaterials = {
  'ui.container': ContainerMaterial,
  'ui.layout': LayoutMaterial,
  'ui.form': FormMaterial,
  'ui.radioGroup': RadioGroupMaterial,
  'ui.checkboxGroup': CheckboxGroupMaterial,
  'ui.date': DateMaterial,
  'ui.time': TimeMaterial,
  'ui.rate': RateMaterial,
  'ui.slider': SliderMaterial,
  'ui.colorPicker': ColorPickerMaterial,
  'ui.cascader': CascaderMaterial,
  'ui.upload': UploadMaterial,
  'ui.richText': RichTextMaterial,
  'ui.richTextDisplay': RichTextDisplayMaterial,
  'ui.fieldArray': FieldArrayMaterial,
  'ui.card': CardMaterial,
  'ui.divider': DividerMaterial,
  'ui.tabs': TabsMaterial,
  'ui.tabPanel': TabPanelMaterial,
  'ui.image': ImageMaterial,
  'ui.link': LinkMaterial,
  'ui.descriptions': DescriptionsMaterial,
  'ui.list': ListMaterial,
  'ui.table': TableMaterial,
  'ui.pagination': PaginationMaterial,
  'ui.dialog': DialogMaterial,
  'ui.drawer': DrawerMaterial,
  'ui.alert': AlertMaterial,
  'ui.loading': LoadingMaterial,
};
export const extendedContracts = {
  ...containerContracts,
  ...groupContracts,
  ...temporalContracts,
  ...rateContracts,
  ...sliderContracts,
  ...colorPickerContracts,
  ...cascaderContracts,
  ...uploadContracts,
  ...richTextContracts,
  ...fieldArrayContracts,
  ...dataContracts,
  ...feedbackContracts,
};
