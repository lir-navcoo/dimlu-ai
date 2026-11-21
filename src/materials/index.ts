import { RadioGroupMaterial, CheckboxGroupMaterial, groupContracts } from './groups';
import { DateMaterial, TimeMaterial, temporalContracts } from './temporal';
import {
  LayoutMaterial,
  FormMaterial,
  CardMaterial,
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
  'ui.layout': LayoutMaterial,
  'ui.form': FormMaterial,
  'ui.radioGroup': RadioGroupMaterial,
  'ui.checkboxGroup': CheckboxGroupMaterial,
  'ui.date': DateMaterial,
  'ui.time': TimeMaterial,
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
  ...fieldArrayContracts,
  ...dataContracts,
  ...feedbackContracts,
};
